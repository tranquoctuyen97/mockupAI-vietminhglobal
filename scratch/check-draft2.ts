import { prisma } from '../src/lib/db';

async function main() {
  const draft = await prisma.wizardDraft.findFirst({
    where: { id: 'cmpnku9ep000t8ht010mszmhj' },
    select: { id: true, tenantId: true, designId: true, draftDesigns: { select: { designId: true, id: true } } }
  });
  if (!draft) { console.log('DRAFT NOT FOUND IN DB'); return; }
  console.log('tenantId:', draft.tenantId);
  console.log('designId:', draft.designId);
  console.log('draftDesigns count:', draft.draftDesigns.length);
  console.log('draftDesigns:', JSON.stringify(draft.draftDesigns));

  // Check all designs referenced in draftDesigns
  if (draft.draftDesigns.length > 0) {
    const designIds = draft.draftDesigns.map(d => d.designId);
    const designs = await prisma.design.findMany({
      where: { id: { in: designIds } },
      select: { id: true, name: true, status: true, deletedAt: true, tenantId: true }
    });
    console.log('\nDesigns in DB:', JSON.stringify(designs, null, 2));
  }
}
main().finally(() => prisma.$disconnect());
