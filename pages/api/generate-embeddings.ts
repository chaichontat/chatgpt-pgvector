import { supabaseClient } from "@/lib/embeddings-supabase";
import * as cheerio from "cheerio";
import { log } from "console";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import puppeteer from "puppeteer";
// embedding doc sizes
const docSize: number = 500;

let browserPromise = puppeteer.launch({ headless: "new" });

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method, body } = req;

  if (method === "POST") {
    const { urls } = body;
    const documents = await getDocuments(urls);

    for (const { url, body } of documents) {
      if (body.length < 100) {
        console.log("skipping document with length < 100");
        continue;
      }

      const input = body.replace(/\n/g, " ");

      console.log("\nDocument length: \n", body.length);
      console.log("\nURL: \n", url);

      const apiKey = process.env.OPENAI_API_KEY;
      const apiURL =
        process.env.OPENAI_PROXY == ""
          ? "https://api.openai.com"
          : process.env.OPENAI_PROXY;

      const embeddingResponse = await fetch(apiURL + "/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input,
          model: "text-embedding-ada-002"
        })
      });
      // console.log("\nembeddingResponse: \n", embeddingResponse);
      const embeddingData = await embeddingResponse.json();

      const [{ embedding }] = embeddingData.data;
      // console.log("embedding:" + embedding);

      // In production we should handle possible errors
      try {
        let res = await supabaseClient.from("documents").insert({
          content: input,
          embedding,
          url
        });
      } catch (error) {
        console.error("error in supabase insert: " + error);
      }
    }
    return res.status(200).json({ success: true });
  }

  return res
    .status(405)
    .json({ success: false, message: "Method not allowed" });
}

function extractTopLevelDomain(url: string) {
  const domain = new URL(url).hostname;
  const topLevelDomain = domain.split(".").slice(-2)[0];
  return topLevelDomain;
}

const goodClass: Record<string, string> = {
  nature: ".main-content",
  sciencedirect: ".Body",
  nih: ".article",
  science: "#abstracts #bodymatter",
  pnas: ".core-container"
};

function normalizeUrl(url: string) {
  // Remove trailing slashes
  url = url.replace(/\/+$/, "");

  // Remove section navigators
  const hashIndex = url.indexOf("#");
  if (hashIndex !== -1) {
    url = url.substring(0, hashIndex);
  }

  return url;
}

async function getDocuments(urls: string[]) {
  const documents = [];

  urls = urls.map(normalizeUrl);

  let res = await supabaseClient.from("unique_url").select("url");
  let existingurls = res.data?.map((row) => row.url);

  if (existingurls) {
    urls = urls.filter((url) => !existingurls.includes(url));
  }
  const browser = await browserPromise;

  for (const url of urls) {
    let fetchURL = url;
    // if (process.env.SPLASH_URL != "") {
    //   fetchURL = `${
    //     process.env.SPLASH_URL
    //   }/render.html?url=${encodeURIComponent(url)}&timeout=10&wait=0.5`;
    // }
    console.log("fetching url: " + fetchURL);
    const tld = extractTopLevelDomain(url);
    console.log(tld);

    // const response = await fetch(fetchURL, {
    //   headers: {
    //     "User-Agent":
    //       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15"
    //   }
    // });
    const page = await browser.newPage();
    await page.goto(fetchURL, { waitUntil: "networkidle0" });
    // await page.waitForSelector(waitUntil[tld] ?? goodClass[tld].split(" ")[0]);
    const html = await page.content();
    // write html to file
    // change url so that it is a valid filename
    // ignore https:// and replace all non-alphanumeric characters with _
    const filename = url.replace(/https:\/\//, "").replace(/\W/g, "_");
    fs.writeFileSync(filename + ".html", html);
    await page.close();

    const $ = cheerio.load(html);
    // tag based e.g. <main>
    // Retrieve all elements with class "main-content"

    const articleText = goodClass[tld]
      .split(" ")
      .map((el) => $(el).text())
      .join(" ");
    // const articleText = $("body").text();
    // class bsaed e.g. <div class="docs-content">
    // const articleText = $(".docs-content").text();

    let start = 0;
    const words = articleText.split(" ");
    while (start < words.length) {
      const end = start + docSize;
      const chunk = words.slice(start, end).join(" ");
      documents.push({ url, body: chunk });
      start = end - 20; // overlap of 50.
    }
  }

  return documents;
}
