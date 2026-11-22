// Teststelle 2: Werkzeugfenster „Database“ (Ticket 20) gegen ein PostgreSQL aus embedded-postgres auf einem Zufallsport.

import type { Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchCodium, prepareAppState } from '../support/launchApp';
import { PG_DATABASE, PG_PASSWORD, PG_USER, postgresProcessesFor, startPostgres, type TestPostgres } from '../support/postgres';
import { useTempDirs } from '../support/tempDir';
import * as fs from 'node:fs';
import * as path from 'node:path';

function node(page: Page, name: string): Locator {
  return page.getByRole('tree', { name: 'Database' }).getByRole('treeitem', { name, exact: true });
}

describe('Werkzeugfenster „Database“', () => {
  const tempDir = useTempDirs();
  let server: TestPostgres;

  beforeAll(async () => {
    server = await startPostgres();
    await server.sql(`
      CREATE SCHEMA crm;
      CREATE TABLE crm.customers (id serial PRIMARY KEY, name text NOT NULL, email varchar(40));
      CREATE VIEW crm.named_customers AS SELECT id, name FROM crm.customers;
    `);
  });

  afterAll(async () => {
    const dataDir = server?.dataDir;
    await server?.stop();
    if (dataDir) expect(postgresProcessesFor(dataDir)).toBe(0);
  });

  it('legt eine Verbindung an, klappt den Baum auf und zeigt eine Tabelle mit ihren Spalten', async () => {
    const project = path.join(tempDir(), 'Shop');
    fs.mkdirSync(project);
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [project], recentProjects: [project] });
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page('Shop – Codium');
      await page.getByRole('navigation').getByRole('button', { name: 'Database', exact: true }).click({ timeout: 15_000 });
      await page.getByRole('button', { name: 'New Connection' }).click();
      const dialog = page.getByRole('dialog', { name: 'New Connection' });
      await dialog.getByLabel('Name', { exact: true }).fill('Shop DB');
      await dialog.getByLabel('Host', { exact: true }).fill('127.0.0.1');
      await dialog.getByLabel('Port', { exact: true }).fill(String(server.port));
      await dialog.getByLabel('Database', { exact: true }).fill(PG_DATABASE);
      await dialog.getByLabel('User', { exact: true }).fill(PG_USER);
      // Erst ein falsches Passwort: die Meldung der Datenbank.
      await dialog.getByLabel('Password', { exact: true }).fill('falsch');
      await dialog.getByRole('button', { name: 'Test Connection' }).click();
      await expect.poll(() => dialog.getByRole('alert').innerText(), { timeout: 20_000 }).toMatch(/password authentication failed/);
      await dialog.getByLabel('Password', { exact: true }).fill(PG_PASSWORD);
      await dialog.getByRole('button', { name: 'Test Connection' }).click();
      await expect.poll(() => dialog.getByRole('status').innerText(), { timeout: 20_000 }).toMatch(/^Connected: PostgreSQL \d+/);
      await dialog.getByRole('button', { name: 'OK' }).click();
      await dialog.waitFor({ state: 'detached' });

      await node(page, 'Shop DB').dblclick();
      await node(page, PG_DATABASE).dblclick();
      await node(page, 'crm').waitFor({ timeout: 20_000 });
      expect(await node(page, 'pg_catalog').count()).toBe(0);
      await node(page, 'crm').dblclick();
      await node(page, 'named_customers').waitFor({ timeout: 20_000 });
      await node(page, 'customers').locator('.database-arrow').click();
      const id = node(page, 'id');
      await id.waitFor({ timeout: 20_000 });
      expect(await id.innerText()).toContain('integer not null');
      expect(await id.locator('.database-pk').count()).toBe(1);
      expect(await node(page, 'email').innerText()).toContain('character varying(40)');
    } finally {
      await codium.close();
    }
  });
});
