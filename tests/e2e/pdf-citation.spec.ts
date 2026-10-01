// Browser test for M3: a PDF citation carries the correct page number through
// retrieval, validation and the citation popover. Uses the OpenAI mock; its
// bag-of-words embeddings rank the page that shares words with the question.
import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";
const NOTEBOOK_TITLE = `E2E PDF ${Date.now()}`;

test("PDF-Zitat zeigt die richtige Seite", async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageOne = doc.addPage([500, 300]);
  pageOne.drawText("Allgemeine Einleitung ohne besondere Begriffe.", {
    x: 40, y: 200, size: 12, font,
  });
  const pageTwo = doc.addPage([500, 300]);
  pageTwo.drawText("Die Turbinenrevision findet alle vier Jahre im Herbst statt.", {
    x: 40, y: 200, size: 12, font,
  });
  const pdf = Buffer.from(await doc.save());

  await page.goto("/login");
  await page.getByLabel("Demo-Passwort").fill(PASSWORD);
  await page.getByRole("button", { name: "Demo öffnen" }).click();
  await page.getByLabel("Titel des neuen Notebooks").fill(NOTEBOOK_TITLE);
  await page.getByRole("button", { name: "Notebook anlegen" }).click();
  await page.getByRole("link", { name: NOTEBOOK_TITLE }).click();

  await page.locator('input[type="file"]').setInputFiles({
    name: "anlagen.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(page.getByText("Bereit")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("2 Seiten")).toBeVisible();

  await page
    .getByLabel("Frage an die Quellen")
    .fill("Wann findet die Turbinenrevision statt?");
  await page.getByRole("button", { name: "Senden" }).click();

  const chip = page.getByRole("button", { name: /^Quelle 1:/ });
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(chip).toHaveAccessibleName(/anlagen\.pdf, Seite 2/);

  await chip.click();
  await expect(page.getByText("Seite 2").last()).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("Turbinenrevision");

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Fundus" }).click();
  const row = page.getByRole("listitem").filter({ hasText: NOTEBOOK_TITLE });
  await row.getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByRole("link", { name: NOTEBOOK_TITLE })).toHaveCount(0);
});
