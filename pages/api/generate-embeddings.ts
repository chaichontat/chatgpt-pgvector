import { supabaseClient } from "@/lib/embeddings-supabase";
import * as cheerio from "cheerio";
import { log } from "console";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import puppeteer from "puppeteer";
// embedding doc sizes
const docSize: number = 100;

let browserPromise = puppeteer.launch({ headless: "new" });

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method, body } = req;

  if (method === "POST") {
    const { urls } = body;
    const documents = await getDocuments(urls);
    console.log("sending documents");

    // await fetch("http://100.64.128.70:8000/", {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json"
    //   },
    //   body: JSON.stringify({ items: documents })
    // });
    // console.log("done");
    const apiKey = process.env.OPENAI_API_KEY;

    const apiURL =
      process.env.OPENAI_PROXY == ""
        ? "https://api.openai.com"
        : process.env.OPENAI_PROXY;

    for (const { body, doi } of documents) {
      if (body.length < 100) {
        console.log("skipping document with length < 100");
        continue;
      }

      const input = body.replace(/\n/g, " ");

      console.log("\nDocument length: \n", body.length);
      console.log("\nURL: \n", doi);

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

      try {
        let res = await supabaseClient.from("documents").insert({
          content: input,
          embedding,
          doi
        });
      } catch (error) {
        console.error("error in supabase insert: " + error);
      }
    }
    return res.status(200).json({ success: true });

    return res
      .status(405)
      .json({ success: false, message: "Method not allowed" });
  }
}

function extractHostname(url: string) {
  const domain = new URL(url).hostname;
  const topLevelDomain = domain.split(".").slice(-2)[0];
  return topLevelDomain;
}

const goodClass: Record<string, string> = {
  nature: ".main-content",
  sciencedirect: ".Body",
  nih: ".sec",
  science: "#abstracts #bodymatter",
  pnas: "#abstracts #bodymatter"
};

const toRemove: Record<string, string> = {
  nih: "[id^=fn], [id^=ref], .fig, a",
  nature: 'sup, .c-article-section__figure, a, [data-title="Methods"]',
  sciencedirect: "figure, [id^=ack], .Appendices, [name^=bbib]",
  science: '.figure-wrap, section[role="doc-acknowledgments"], a',
  pnas: ".figure-wrap, a"
};

const doiTag: Record<string, string> = {
  nature: "meta[name=citation_doi]",
  nih: "meta[name=citation_doi]",
  sciencedirect: "meta[name=citation_doi]",
  science: "meta[name=dc.Identifier][scheme=doi]",
  pnas: "meta[name=dc.Identifier][scheme=doi]"
};

function normalizeUrl(url: string) {
  // Remove trailing slashes
  url = url.replace(/\/+$/, "");

  // Remove section navigators
  const hashIndex = url.indexOf("#");
  if (hashIndex !== -1) {
    url = url.substring(0, hashIndex);
  }
  const queryIndex = url.indexOf("?");
  if (queryIndex !== -1) {
    url = url.substring(0, queryIndex);
  }

  return url;
}

async function getDocuments(urls: string[]) {
  const documents = [];

  urls = urls.map(normalizeUrl);

  // let res = await supabaseClient.from("unique_doi").select("doi");
  // let existingurls = res.data?.map((row) => row.doi);
  const browser = await browserPromise;

  for (const url of urls) {
    let fetchURL = url;
    // if (process.env.SPLASH_URL != "") {
    //   fetchURL = `${
    //     process.env.SPLASH_URL
    //   }/render.html?url=${encodeURIComponent(url)}&timeout=10&wait=0.5`;
    // }
    console.log("fetching url: " + fetchURL);
    const tld = extractHostname(url);
    console.log(tld);

    // const response = await fetch(fetchURL, {
    //   headers: {
    //     "User-Agent":
    //       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15"
    //   }
    // });
    const page = await browser.newPage();
    await page.goto(fetchURL, { waitUntil: "networkidle0" });
    await page.waitForSelector(goodClass[tld].split(" ")[0]);

    // await page.waitForSelector(waitUntil[tld] ?? goodClass[tld].split(" ")[0]);
    const html = await page.content();
    // write html to file
    // change url so that it is a valid filename
    // ignore https:// and replace all non-alphanumeric characters with _
    const filename = url.replace(/https:\/\//, "").replace(/\W/g, "_");
    fs.writeFileSync(filename + ".html", html);
    await page.close();

    const $ = cheerio.load(html);
    const doi = $(doiTag[tld]).attr("content");

    if (toRemove[tld]) $(toRemove[tld]).remove();

    // tag based e.g. <main>
    // Retrieve all elements with class "main-content"

    const articleText = goodClass[tld]
      .split(" ")
      .map((el) => $(el).text())
      .join(" ")
      .replace(/\.(A-Z)/g, ". $1")
      .replace(/ \(([;,]\s)*\)/g, "")
      .replace(/\[(,\s?)*\]\s?/g, "")
      .replace(/\s[\.,]\s/g, ". ")
      .replace(/\s+/g, " ");
    // const articleText = $("body").text();
    // class bsaed e.g. <div class="docs-content">
    // const articleText = $(".docs-content").text();

    fs.writeFileSync(filename + ".txt", articleText);

    let start = 0;
    const words = articleText.split(" ");
    while (start < words.length) {
      const end = start + docSize;
      const chunk = words.slice(start, end).join(" ");
      documents.push({ doi, body: chunk });
      start = end - 20; // overlap of 50.
    }
  }

  return documents;
}
