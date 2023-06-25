import { useState, useEffect } from "react";
import { supabaseClient } from "@/lib/embeddings-supabase";
import { LRUCache } from "lru-cache";

const cache = new LRUCache<string, string>({ max: 1000 });

async function getMetadata(doi: string) {
  if (cache.has(doi)) {
    return cache.get(doi) as string;
  }

  const resp = await supabaseClient
    .from("citation")
    .select("*")
    .eq("doi", doi)
    .single();
  const data = resp.data as {
    id: number;
    doi: string;
    title: string;
    first_author: string;
    year: number;
    journal: string;
  };
  if (!data) {
    console.error("No data for doi", doi)
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
