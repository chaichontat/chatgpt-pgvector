import { useState } from "react";
import DataTable from "./DataTableBase";
import { ExpanderComponentProps } from "react-data-table-component";

const columns = [
  "title",
  "journal",
  "citations",
  "doi",
  "abstract",
  "authors"
] as const;
type Result = Record<(typeof columns)[number], string>;

const tableColumns = [
  {
    name: "Title",
    selector: (row: Result) => row.title,
    cell: (row: Result) => <CustomTitle row={row} />
  }
];

const CustomTitle = ({ row }: { row: Result }) => (
  <div className="my-2">
    <a
      href={"https://doi.org/" + row.doi}
      className="text-left text-sm"
      target="_blank"
      rel="noopener noreferrer"
    >
      {row.title}
    </a>
    <div
      data-tag="allowRowEvents"
      className="text-left overflow-hidden text-sm whitespace-pre-wrap overflow-ellipsis text-neutral-500"
    >
      {row.authors} et al. <i>{row.journal}</i> ({row.year}) Cited by{" "}
      {row.citations}
    </div>
  </div>
);

export default function Query() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([] as Result[]);
  const [pending, setPending] = useState(false);

  const get = async (query: string) => {
    setPending(true);
    const resp = (await fetch("/api/adder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    }).then((res) => res.json())) as Result[];

    setResults(resp);
    setPending(false);
  };

  return (
    <div className="w-full">
      <input
        className="w-full px-3 py-2 mb-2 text-base text-gray-700 placeholder-gray-600 border rounded-lg focus:shadow-outline"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button onClick={() => get(query)}>Search</button>

      <div className="mb-2 w-full rounded-md">
        <DataTable
          columns={tableColumns}
          data={results}
          keyField="doi"
          selectableRows
          progressPending={pending}
        />
        ;
      </div>
    </div>
  );
}
