import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NormalizedProject, NormalizedTransition } from './types.js';
import { allTransitions } from './graph.js';
import { WirestateError } from './errors.js';

function actionFor(transition: NormalizedTransition): string {
  const interaction = transition.interaction;
  if (!interaction) return '  // TODO: perform the domain action that emits this event.';
  const selector = interaction.component ? `[data-wirestate-id="${interaction.component}"]` : '[data-wirestate-id="TODO"]';
  if (interaction.kind === 'fill') return `  await page.locator(${JSON.stringify(selector)}).fill(${JSON.stringify(interaction.value ?? '')});`;
  if (interaction.kind === 'toggle') return `  await page.locator(${JSON.stringify(selector)}).check();`;
  if (interaction.kind === 'submit') return `  await page.locator(${JSON.stringify(selector)}).press('Enter');`;
  if (interaction.kind === 'wait') return `  await page.waitForTimeout(${transition.wait?.afterMs ?? 100});`;
  if (interaction.kind === 'custom') return `  // TODO: execute custom fixture ${JSON.stringify(interaction.fixture ?? 'unnamed')}.`;
  return `  await page.locator(${JSON.stringify(selector)}).click();`;
}

function waitFor(transition: NormalizedTransition): string {
  if (transition.wait?.until?.selector) {
    return `\n  await page.locator(${JSON.stringify(transition.wait.until.selector)}).waitFor({ timeout: ${transition.wait.timeoutMs ?? 5000} });`;
  }
  if (transition.wait?.until?.text) {
    return `\n  await page.getByText(${JSON.stringify(transition.wait.until.text)}).waitFor({ timeout: ${transition.wait.timeoutMs ?? 5000} });`;
  }
  if (transition.wait?.afterMs) return `\n  await page.waitForTimeout(${transition.wait.afterMs});`;
  return '';
}

export function generatePlaywrightSmoke(project: NormalizedProject, machineId: string): string {
  const machine = project.machines[machineId];
  if (!machine) throw new WirestateError(`Unknown machine: ${machineId}`, 'MACHINE_UNKNOWN');
  const cases = allTransitions(machine).map((transition) => {
    const source = transition.source.slice(machineId.length + 1);
    const target = transition.target.slice(machineId.length + 1);
    return `  test.skip(${JSON.stringify(`${source} --${transition.event}--> ${target}`)}, async ({ page }, testInfo) => {\n    // TODO: replace test.skip with test after arranging the application in the source state.\n    const recorder = new WirestateRecorder({ testName: testInfo.title });\n    await page.goto('/');\n    recorder.state(${JSON.stringify(machineId)}, ${JSON.stringify(source)});\n${actionFor(transition)}${waitFor(transition)}\n    recorder.transition(${JSON.stringify(machineId)}, ${JSON.stringify(source)}, ${JSON.stringify(transition.event)}, ${JSON.stringify(target)});\n    await collectBrowserTrace(page, recorder);\n    await recorder.flush();\n    expect(recorder.snapshot().length).toBeGreaterThan(0);\n  });`;
  }).join('\n\n');

  return `import { test, expect } from '@playwright/test';\nimport { WirestateRecorder, collectBrowserTrace } from 'wirestate/playwright';\n\ntest.describe('generated smoke: ${machineId}', () => {\n${cases}\n});\n`;
}

export async function writePlaywrightSmoke(project: NormalizedProject, machineId: string, output: string): Promise<void> {
  const absolute = path.resolve(project.rootDir, output);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, generatePlaywrightSmoke(project, machineId), 'utf8');
}
