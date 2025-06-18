const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3000;

// Security and CORS middleware
app.use(helmet());
app.use(cors());

// Generate random IP for X-Forwarded-For header
function generateRandomIP() {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join(
    "."
  );
}

// Add delay between requests
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cache control headers
const setCacheHeaders = (res, maxAge = 3600) => {
  res.set({
    "Cache-Control": `public, max-age=${maxAge}`,
    ETag: true,
  });
};

// Main proxy endpoint
app.get("/", (req, res) => {
  res
    .status(200)
    .json({
      success: true,
      message: `"Image Proxy API is Online and Running! Use /proxy/image?url=<image_url> to fetch images."`,
    });
});
app.get("/proxy/image", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: "URL parameter is required" });
    }

    // Validate URL
    if (!isValidImageUrl(url)) {
      return res.status(400).json({ error: "Invalid image URL" });
    }

    // Enhanced headers to bypass 403 - rotate user agents
    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ];

    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    const headers = {
      "User-Agent": randomUA,
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Ch-Ua":
        '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      Referer: "https://www.threads.net/",
      Origin: "https://www.threads.net",
    };

    // Fetch the image with multiple retry strategies
    let response;
    let lastError;

    // Strategy 1: Direct request
    try {
      response = await axios({
        method: "GET",
        url: url,
        headers,
        responseType: "arraybuffer",
        timeout: 25000, // Increased for Lambda
        maxRedirects: 5,
      });
    } catch (error) {
      lastError = error;
      console.log("Direct request failed, trying alternative methods...");

      // Strategy 2: Request without some headers
      try {
        const minimalHeaders = {
          "User-Agent": randomUA,
          Accept: "image/*,*/*;q=0.8",
          Referer: "https://www.threads.net/",
        };

        response = await axios({
          method: "GET",
          url: url,
          headers: minimalHeaders,
          responseType: "arraybuffer",
          timeout: 25000,
          maxRedirects: 5,
        });
      } catch (error2) {
        lastError = error2;

        // Strategy 3: Try with different referer
        try {
          const altHeaders = {
            "User-Agent": randomUA,
            Accept: "image/*,*/*;q=0.8",
            Referer: "https://instagram.com/",
            "X-Forwarded-For": generateRandomIP(),
          };

          response = await axios({
            method: "GET",
            url: url,
            headers: altHeaders,
            responseType: "arraybuffer",
            timeout: 25000,
            maxRedirects: 5,
          });
        } catch (error3) {
          lastError = error3;
          throw lastError; // All strategies failed
        }
      }
    }

    // Get content type
    const contentType = response.headers["content-type"] || "image/jpeg";

    // Set cache headers
    setCacheHeaders(res, 86400); // Cache for 24 hours

    // Send original image (no processing needed)
    res.set("Content-Type", contentType);
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error("Proxy error:", error.message);

    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      return res.status(404).json({ error: "Image not found" });
    }

    if (error.response?.status === 403) {
      return res.status(403).json({ error: "Access forbidden" });
    }

    if (error.code === "ETIMEDOUT") {
      return res.status(408).json({ error: "Request timeout" });
    }

    res.status(500).json({ error: "Failed to fetch image" });
  }
});

// URL validation
function isValidImageUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const validDomains = [
      "scontent.cdninstagram.com",
      "instagram.com",
      "threads.net",
      "fbcdn.net",
      "scontent.xx.fbcdn.net",
    ];

    return validDomains.some(
      (domain) =>
        parsedUrl.hostname.includes(domain) ||
        parsedUrl.hostname.endsWith(domain)
    );
  } catch {
    return false;
  }
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Image proxy server running on port ${PORT}`);
});
