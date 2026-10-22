import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_PROJECT } from './global-setup.js';

/**
 * The whole stack minus the Tauri shell: Chromium → Vite build → dev bridge → MCP server
 * → core, with the scripted stand-in model. Open a project, create a chapter, type, write
 * a continuation, accept it, and check that the chapter file on disk changed only then.
 */
test.describe('desktop smoke (browser, scripted model)', () => {
  test('open, write, accept', async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept('Фары'));
    await page.goto('/');

    // Welcome: the app connects to the sidecar and offers to open a folder.
    const pathInput = page.getByPlaceholder(/Path to a story folder|Путь к папке истории/);
    await expect(pathInput).toBeVisible({ timeout: 30_000 });
    await pathInput.fill(E2E_PROJECT);
    await pathInput.press('Enter');

    // The project is open: the tree shows its sections and the status bar the scripted model.
    const tree = page.getByRole('navigation', { name: /Project tree|Дерево проекта/ });
    await expect(tree).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.statusbar__model')).toContainText(/scripted|скриптован/i);

    // A new chapter through the tree (the title comes from the prompt dialog).
    await page.getByRole('button', { name: /New chapter|Новая глава/ }).first().click();
    const editor = page.locator('.cm-content');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(tree.getByText(/Фары/)).toBeVisible();

    // The Author types; the idle autosave writes the chapter through chapter_save.
    await editor.click();
    await page.keyboard.type('Бабка Нюра не уходила.');
    await expect(page.getByTestId('status-chapter-words')).toHaveText(/4/, { timeout: 10_000 });
    const chapterFile = () => fs.readdirSync(path.join(E2E_PROJECT, 'chapters')).map((f) => path.join(E2E_PROJECT, 'chapters', f))[0]!;
    await expect.poll(() => fs.readFileSync(chapterFile(), 'utf8'), { timeout: 15_000 }).toContain('Бабка Нюра не уходила.');

    // Write: Ctrl+Enter streams a continuation into the suggestion block; the chapter is untouched until Accept.
    await page.keyboard.press('Control+Enter');
    const accept = page.getByRole('button', { name: /^(Accept|Принять)$/ });
    await expect(accept).toBeVisible({ timeout: 60_000 });
    expect(fs.readFileSync(chapterFile(), 'utf8')).not.toContain('Утром над посёлком');
    await accept.click();

    // After Accept the chapter carries the suggestion and the editor shows it.
    await expect.poll(() => fs.readFileSync(chapterFile(), 'utf8'), { timeout: 30_000 }).toContain('Утром над посёлком');
    await expect(editor).toContainText('Утром над посёлком', { timeout: 15_000 });
    await expect(page.getByTestId('status-chapter-words')).not.toHaveText(/^4\b/);

    // The call log records the generation and the accept; the key never appears anywhere on disk.
    const calls = fs.readFileSync(path.join(E2E_PROJECT, 'history', 'calls.jsonl'), 'utf8');
    expect(calls).toContain('"task":"write.continue"');
    expect(calls).toContain('"accepted":true');
    expect(calls).not.toMatch(/sk-ant-/);
  });
});
