import { zipSync, strToU8 } from "fflate";
import { describe, expect, test } from "bun:test";
import { DocumentError, documentKind, extractDocument, MAX_TEXT_BYTES } from "./extract";

/** A one-page-per-string PDF with real text, built here so the test needs no file. */
function pdfOf(pages: string[]) {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const font = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
    );
    const stream = `BT /F1 14 Tf 20 150 Td (${text}) Tj ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(out);
}

const ct = (extra: string) => `<?xml version="1.0"?><Types xmlns="x">${extra}</Types>`;
const docxOf = (body: string) =>
  zipSync({
    "[Content_Types].xml": strToU8(ct("")),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
    ),
  });

describe("documentKind", () => {
  test("the extension decides, the reported type is the fallback, anything else is not a document", () => {
    expect(documentKind("Report.PDF")).toBe("pdf");
    expect(documentKind("a.docx")).toBe("docx");
    expect(documentKind("table.tsv")).toBe("tsv");
    expect(documentKind("noext", "application/pdf")).toBe("pdf");
    expect(documentKind("notes.txt", "text/plain")).toBeUndefined();
    expect(documentKind("image.png", "image/png")).toBeUndefined();
  });
});

describe("extractDocument", () => {
  test("a PDF gives its text page by page", async () => {
    const r = await extractDocument(pdfOf(["Quarterly sales grew", "Second page here"]), "pdf");
    expect(r.text).toContain("--- Page 1 ---");
    expect(r.text).toContain("Quarterly sales grew");
    expect(r.text).toContain("--- Page 2 ---");
    expect(r.text).toContain("Second page here");
    expect(r.truncated).toBe(false);
  });

  test("a PDF with more pages than the limit is read up to it, and says so", async () => {
    const r = await extractDocument(
      pdfOf(Array.from({ length: 205 }, (_, i) => `page number ${i + 1}`)),
      "pdf",
    );
    expect(r.text).toContain("page number 200");
    expect(r.text).not.toContain("page number 201");
    expect(r.truncated).toBe(true);
    expect(r.note).toContain("first 200 of 205 pages");
  });

  test("a PDF with no text (a scan) or damaged bytes is refused with a sentence", async () => {
    await expect(extractDocument(pdfOf([""]), "pdf")).rejects.toMatchObject({ code: "EMPTY" });
    await expect(extractDocument(strToU8("%PDF-1.4 nope"), "pdf")).rejects.toMatchObject({
      code: "UNREADABLE",
    });
    await expect(extractDocument(strToU8("not a pdf at all"), "pdf")).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });

  test("a Word document gives paragraphs, tabs, line breaks and table rows", async () => {
    const r = await extractDocument(
      docxOf(
        `<w:p><w:r><w:t>Title &amp; more</w:t></w:r></w:p><w:p><w:r><w:t>One</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Two</w:t></w:r><w:br/><w:r><w:t>Three</w:t></w:r></w:p>` +
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      ),
      "docx",
    );
    expect(r.text).toContain("Title & more");
    expect(r.text).toContain("One\tTwo\nThree");
    expect(r.text).toMatch(/A1\s+B1/);
  });

  test("a PowerPoint file gives each slide under its number, in order", async () => {
    const slide = (t: string) =>
      `<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const bytes = zipSync({
      "ppt/slides/slide10.xml": strToU8(slide("ten")),
      "ppt/slides/slide2.xml": strToU8(slide("two")),
      "ppt/slides/slide1.xml": strToU8(slide("one")),
    });
    const r = await extractDocument(bytes, "pptx");
    expect(r.text.indexOf("Slide 1 ---\none")).toBeGreaterThanOrEqual(0);
    expect(r.text.indexOf("Slide 2")).toBeGreaterThan(r.text.indexOf("Slide 1"));
    expect(r.text.indexOf("Slide 10")).toBeGreaterThan(r.text.indexOf("Slide 2"));
  });

  test("an Excel file gives each sheet as tab-separated rows, with shared and inline strings, numbers and gaps", async () => {
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(
        `<workbook><sheets><sheet name="Sales" sheetId="1"/><sheet name="Notes" sheetId="2"/></sheets></workbook>`,
      ),
      "xl/sharedStrings.xml": strToU8(
        `<sst><si><t>Region</t></si><si><t>North &amp; East</t></si></sst>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Total</t></is></c></row>` +
          `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>42</v></c></row></sheetData></worksheet>`,
      ),
      "xl/worksheets/sheet2.xml": strToU8(
        `<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>hello</v></c></row></sheetData></worksheet>`,
      ),
    });
    const r = await extractDocument(bytes, "xlsx");
    expect(r.text).toContain("## Sales\nRegion\tTotal\nNorth & East\t\t42");
    expect(r.text).toContain("## Notes\nhello");
  });

  test("a CSV and a TSV come through as the text they are; a binary one is refused", async () => {
    const csv = await extractDocument(new TextEncoder().encode("﻿name,qty\nbolts,12\n"), "csv");
    expect(csv.text).toBe("name,qty\nbolts,12");
    await expect(extractDocument(new Uint8Array([1, 2, 0, 3]), "csv")).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });

  test("a zip with too many parts, a file that is not the type it says, and text over 256 KB are handled", async () => {
    const many = zipSync(
      Object.fromEntries(
        Array.from({ length: 450 }, (_, i) => [
          `ppt/slides/slide${i + 1}.xml`,
          strToU8("<a:t>x</a:t>"),
        ]),
      ),
    );
    await expect(extractDocument(many, "pptx")).rejects.toMatchObject({ code: "TOO_BIG" });
    await expect(extractDocument(strToU8("plain text"), "docx")).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
    await expect(
      extractDocument(zipSync({ "other.txt": strToU8("x") }), "docx"),
    ).rejects.toBeInstanceOf(DocumentError);
    const big = await extractDocument(
      new TextEncoder().encode(`${"x".repeat(300)}\n`.repeat(1500)),
      "csv",
    );
    expect(new TextEncoder().encode(big.text).length).toBeLessThanOrEqual(MAX_TEXT_BYTES);
    expect(big.truncated).toBe(true);
    expect(big.note).toContain("256 KB");
  });
});
