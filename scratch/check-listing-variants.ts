import { prisma } from "../src/lib/db";

async function main() {
  const listingId = "cmqqt6ums000qlxt0ospvjdsi";
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { variants: true }
  });

  console.log("Listing title:", listing?.title);
  console.log("Listing variants:", JSON.stringify(listing?.variants, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
