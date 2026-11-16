import { expect, test } from "bun:test";
import { DOCUMENT_EXTENSIONS, DOCUMENT_MAX_BYTES, isDocumentFile } from "./chat-client";

test("the files the server reads the text of are recognised by their extension, in any case", () => {
  for (const name of [
    "a.pdf",
    "B.DOCX",
    "deck.pptx",
    "t.xlsx",
    "x.csv",
    "y.TSV",
    "my.report.final.pdf",
  ])
    expect(isDocumentFile({ name }), name).toBe(true);
  for (const name of [
    "notes.txt",
    "pic.png",
    "script.ts",
    "pdf",
    "archive.zip",
    "report.pdf.exe",
    "",
  ])
    expect(isDocumentFile({ name }), name).toBe(false);
  expect(DOCUMENT_EXTENSIONS).toHaveLength(6);
  expect(DOCUMENT_MAX_BYTES).toBe(20 * 1024 * 1024);
});
