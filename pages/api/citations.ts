import { supabaseClient } from "@/lib/embeddings-supabase";
import { SupabaseClient } from "@supabase/supabase-js";
import { NextApiRequest, NextApiResponse } from "next";
import { uploadMetadata } from "./doistuffs";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") {
        return res.status(405).end();
    }
    const { doi } = await req.body;
    const resp = await supabaseClient.from("citation").select("*").eq("doi", doi).single();
    if (!resp.data) {
    console.error("No data for doi", doi);
    const data = await uploadMetadata(supabaseClient, doi);
        if (!data) return res.status(200).json(resp.data);
        return res.status(200).json(resp.data);
  }
    if (resp.error) {
        return res.status(500).json(resp.error);
    }
    return res.status(200).json(resp.data);
}

export default handler;
