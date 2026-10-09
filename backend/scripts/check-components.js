const prisma = require("../src/config/prisma");

async function main() {
  const duplicates = await prisma.$queryRaw`
    SELECT "recipeId", "componentName", COUNT(*)::int AS count
    FROM "RecipeComponent"
    GROUP BY "recipeId", "componentName"
    HAVING COUNT(*) > 1
  `;
  console.log("DUPLICATE_COMPONENT_GROUPS=" + duplicates.length);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("CHECK_FAILED=" + error.message);
  await prisma.$disconnect();
  process.exit(1);
});
