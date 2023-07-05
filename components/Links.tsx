import { useState, useEffect } from "react";
import { LRUCache } from "lru-cache";
import { uploadMetadata } from "pages/api/doistuffs";

const cache = new LRUCache<string, string>({ max: 1000 });

async function _get(doi: string) {
  const resp = await fetch(
    `/api/citations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ doi }),
    }
  );
  console.log(resp)
  return (await resp.json()) as {
    id: number;
    doi: string;
    title: string;
    first_author: string;
    year: number;
    journal: string;
  };
}

async function getMetadata(doi: string) {
  if (cache.has(doi)) {
    return cache.get(doi) as string;
  }

  let data = await _get(doi);
  console.log(data)
  if (!data) {
    return doi;
  }
  const out = `${data.first_author} et al. (${data.year}). ${data.title}. <i>${data.journal}</i>.`;
  cache.set(doi, out);
  return out;
}

export function Link({ doi }: { doi: string }) {
  const [data, setData] = useState("");

  useEffect(() => {
    getMetadata(doi).then((it) => setData(it));
  }, [doi]);

  return (
    <div className="mb-2">
      <a
        className="underline text-accent"
        target="_blank"
        href={"https://doi.org/" + doi.replace(/^[-\s]+/g, "")} // Remove leading hyphens
        dangerouslySetInnerHTML={{ __html: data }}
      ></a>
    </div>
  );
}
