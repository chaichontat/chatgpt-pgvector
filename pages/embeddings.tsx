import { NextPage } from "next";
import { useState } from "react";
import ResizablePanel from "@/components/ResizablePanel";
import { AnimatePresence, motion } from "framer-motion";
import MarkdownRenderer from "@/components/MarkdownRenderer";
const Embeddings: NextPage = () => {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [answer, setAanswer] = useState<String>("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setAanswer("");

    const response = await fetch("/api/generate-embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls })
    });

    setLoading(false);

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const data = response.body;
    if (!data) {
      return;
    }

    const reader = data.getReader();
    const decoder = new TextDecoder();
    let done = false;

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      const chunkValue = decoder.decode(value);
      setAanswer((prev) => prev + chunkValue);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center max-w-xl m-auto text-center">
      <h1 className="w-full my-5 text-2xl font-bold sm:text-4xl ">
        Generate embeddings
      </h1>
      <p className="mb-4">
        Paste a list of URLs below to geneate embeddings using the OpenAI API,
        and add the embeddings to the Supabase embeddings table.
      </p>
      <form onSubmit={handleSubmit}>
        <textarea
          className="w-full h-[150px] textarea textarea-bordered"
          placeholder="Enter URLs here"
          value={urls.join("\n")}
          onChange={(e) => setUrls(e.target.value.split("\n"))}
        />
        <button
          className="my-4 btn btn-primary"
          type="submit"
          disabled={loading}
        >
          Generate Embeddings
        </button>
      </form>
      {loading && <div>Loading...</div>}

      <ResizablePanel>
        <AnimatePresence mode="wait">
          <motion.div className="my-10 space-y-10">
            {answer && (
              <>
                <div>
                  <h2 className="mx-auto text-3xl font-bold sm:text-4xl">
                    Here is your answer:{" "}
                  </h2>
                </div>
                {answer.split(/SOURCES?:/).map((splitanswer, index) => {
                  return (
                    <div
                      className={`p-4 transition bg-neutral border border-neutral-focus shadow-md rounded-xl overflow-x-auto max-w-xl ${
                        index === 0
                          ? "hover:border-accent-focus cursor-copy text-left"
                          : ""
                      }`}
                      key={index}
                    >
                      {index === 0 ? (
                        <MarkdownRenderer content={splitanswer.trim()} />
                      ) : (
                        <></>
                      )}
                      <style>
                        {`
                              p {
                                margin-bottom: 20px;
                              }
                            `}
                      </style>
                    </div>
                  );
                })}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </ResizablePanel>
    </div>
  );
};

export default Embeddings;
