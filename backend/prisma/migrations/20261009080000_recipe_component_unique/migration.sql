-- CreateIndex
CREATE UNIQUE INDEX "RecipeComponent_recipeId_componentName_key" ON "RecipeComponent"("recipeId", "componentName");
