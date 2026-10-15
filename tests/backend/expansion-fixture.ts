import { applyTestMigration, authFixture } from './auth-fixture'

export async function expansionFixture() {
  const fixture = await authFixture()
  try {
    await fixture.db.prepare('CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)').run()
    await applyTestMigration(fixture.db, '0005_catalog_expansion.sql')
    await fixture.db
      .prepare('INSERT INTO d1_migrations VALUES (?)')
      .bind('0005_catalog_expansion.sql')
      .run()
    return fixture
  } catch (error) {
    await fixture.runtime.dispose()
    throw error
  }
}
