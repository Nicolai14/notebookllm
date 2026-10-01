// Central end-to-end flow against the OpenAI mock:
// login -> create notebook -> upload TXT -> ask -> streamed answer ->
// click citation -> original passage visible. No real OpenAI calls.
import { expect, test } from "@playwright/test";
import { join } from "node:path";

const PASSWORD = process.env.DEMO_PASSWORD ?? "";
const NOTEBOOK_TITLE = `E2E Heizwerk ${Date.now()}`;

test("Upload bis anklickbares Zitat", async ({ page }) => {
  // Unauthenticated visit is redirected to the login page.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Demo-Passwort").fill(PASSWORD);
  await page.getByRole("button", { name: "Demo öffnen" }).click();
  await expect(page.getByRole("heading", { name: "Notebooks" })).toBeVisible();

  // Create and open a notebook.
  await page.getByLabel("Titel des neuen Notebooks").fill(NOTEBOOK_TITLE);
  await page.getByRole("button", { name: "Notebook anlegen" }).click();
  await page.getByRole("link", { name: NOTEBOOK_TITLE }).click();
  await expect(page.getByText("Noch keine Quellen.")).toBeVisible();

  // Upload the TXT fixture; processing completes inside the request.
  await page
    .locator('input[type="file"]')
    .setInputFiles(join(__dirname, "fixtures", "heizwerk.txt"));
  await expect(page.getByText("Bereit")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("heizwerk.txt")).toBeVisible();

  // Ask a question; the mock streams an answer citing [1] and the invalid [9].
  const questionBox = page.getByLabel("Frage an die Quellen");
  await questionBox.fill("Wann erfolgt die Wartung der Biomassekessel?");
  await page.getByRole("button", { name: "Senden" }).click();

  const answer = page.getByText(/Die Wartung der Biomassekessel erfolgt/);
  await expect(answer).toBeVisible({ timeout: 30_000 });

  // The valid citation is rendered as a clickable chip ...
  const chip = page.getByRole("button", { name: /^Quelle 1:/ });
  await expect(chip).toBeVisible();
  // ... and the invalid marker [9] was stripped server-side.
  await expect(page.getByText("[9]")).toHaveCount(0);

  // Clicking the chip shows document, section and the original passage.
  await chip.click();
  await expect(page.getByText("heizwerk.txt").last()).toBeVisible();
  await expect(page.locator("blockquote")).toContainText(
    "da in diesem Monat der Wärmebedarf am geringsten ist"
  );

  // Studio: create a summary for the selected sources and open its citation.
  const studio = page.locator("aside").filter({ hasText: "Studio" });
  await studio.getByRole("button", { name: /Zusammenfassung erstellen/ }).click();
  await expect(studio.getByText(/Kernpunkt/).first()).toBeVisible({ timeout: 30_000 });
  const studioChip = studio.getByRole("button", { name: /^Quelle 1:/ });
  await expect(studioChip).toBeVisible();
  await expect(studio.getByText("[77]")).toHaveCount(0);

  // History survives a reload, including the citation chip.
  await page.reload();
  await expect(page.getByText(/Die Wartung der Biomassekessel erfolgt/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Quelle 1:/ }).first()).toBeVisible();

  // Cleanup: delete the notebook (cascade).
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Fundus" }).click();
  const row = page.getByRole("listitem").filter({ hasText: NOTEBOOK_TITLE });
  await row.getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByRole("link", { name: NOTEBOOK_TITLE })).toHaveCount(0);
});
