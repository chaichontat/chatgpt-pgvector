import { AnimatePresence, motion } from "framer-motion";
import type { NextPage } from "next";
import { useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import LoadingDots from "@/components/LoadingDots";
import ResizablePanel from "@/components/ResizablePanel";
import MetaTags from "@/components/MetaTags";
import { ReactNode } from "react";
import { PageMeta } from "../types";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { use } from "react";
import { Link } from "@/components/Links";

interface Props {
  children: ReactNode;
  meta?: PageMeta;
}

const DocsPage: NextPage<Props> = ({ children, meta: pageMeta }: Props) => {
  const [loading, setLoading] = useState(false);
  const [userQ, setUserQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [answer, setAnswer] = useState<String>("");
  const [maxChunks, setMaxChunks] = useState(5);

  const question = userQ;

  const generateAnswer = async (e: any) => {
    e.preventDefault();
    if (!userQ) {
      return toast.error("Please enter a question!");
    }

    setAnswer("");
    setLoading(true);
    const response = await fetch("/api/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question,
        keyword,
        maxChunks
      })
    });
    console.log("Edge function returned.");

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    // This data is a ReadableStream
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
      setAnswer((prev) => prev + chunkValue);
    }

    setLoading(false);
  };

  return (
    <>
      <MetaTags
        title="Webdev Answerbot"
        description="Web Developer answer-bot trained on Supabase, Nextjs, React, TailwindCSS."
        cardImage="/bot/docs-og.png"
        url=""
      />
      <div className="flex flex-col items-center justify-center min-h-screen py-2 mx-auto">
        <main className="flex flex-col items-center justify-center flex-1 w-full min-h-screen px-4 py-2 mx-auto mt-12 text-center sm:mt-20">
          <h1 className="max-w-xl text-2xl font-bold sm:text-4xl">
            Ask me anything<sup>*</sup> about science!
          </h1>
          <div className="w-full max-w-xl">
            <textarea
              value={userQ}
              onChange={(e) => setUserQ(e.target.value)}
              rows={4}
              className="w-full p-2 mt-5 mb-2 border rounded-md shadow-md bg-neutral border-neutral-focus "
              placeholder={
                "e.g. Describe the role of Pax6 and its role in neural progenitor cells in detail."
              }
            />

            <div className="grid grid-cols-3 mb-4 space-x-3">
              <div className="col-span-2">
                <span className="text-left text-sm">
                  Keyword(s) separated by comma
                </span>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="w-full p-2 my-2 border rounded-md shadow-md bg-neutral border-neutral-focus"
                  placeholder={"e.g. Pax6"}
                />
              </div>
              <div>
                <span className="text-left text-sm">Max chunks per source</span>
                <input
                  type="number"
                  value={maxChunks}
                  onChange={(e) => setMaxChunks(parseInt(e.target.value))}
                  className="w-full p-2 my-2 border rounded-md shadow-md bg-neutral border-neutral-focus text-right"
                />
              </div>
            </div>
            {!loading && (
              <button
                className="w-full px-4 py-2 mt-2 font-medium btn btn-primary"
                onClick={(e) => generateAnswer(e)}
              >
                Ask your question &rarr;
              </button>
            )}
            {loading && (
              <button
                className="w-full px-4 py-2 mt-2 font-medium btn btn-primary"
                disabled
              >
                <LoadingDots color="white" style="xl" />
              </button>
            )}
            <Toaster
              position="top-center"
              reverseOrder={false}
              toastOptions={{ duration: 2000 }}
            />
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
                              <>
                                <p className="mb-4">SOURCES</p>
                                <ul className="text-left text-sm -indent-4 ml-6 my-2">
                                  {splitanswer
                                    .trim()
                                    .split("\n")
                                    .filter((url) => url.trim().length > 0)
                                    .map((url) =>
                                      url.includes("/") ? (
                                        <li key={uuidv4()}>
                                          <Link doi={url} />
                                        </li>
                                      ) : (
                                        <li key={uuidv4()}>{url}</li>
                                      )
                                    )}
                                </ul>
                              </>
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
        </main>
      </div>
    </>
  );
};

export default DocsPage;
