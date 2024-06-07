import { createClient } from "@supabase/supabase-js";

interface Client {
  url?: string;
  key?: string;
}

// const client: Client = {
//   url: process.env.NEXT_PUBLIC_SUPABASE_URL,
//   key: process.env.SUPABASE_ANON_KEY
// };

// const client: Client = {
//   url: "https://cyybmlgzvzwxvwicqlmk.supabase.co",
//   key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5eWJtbGd6dnp3eHZ3aWNxbG1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODQwMDA2MDQsImV4cCI6MTk5OTU3NjYwNH0.ba1-OEvQ8ijwhFevR66_7iMPD9gHL9A94X2atqhBmTM"
// };

const client: Client = {
  url: "http://localhost:8000",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE"
};

if (!client.url || !client.key) {
  throw new Error("Missing Supabase credentials");
}

export const supabaseClient = createClient(client.url!, client.key!, {
  auth: { persistSession: true }
});

// supabaseClient.from("unique_doi").select("*").then(console.log);
