# ApparelFlow initial data model

Six Prisma models for cutting orders and component verification:

| Model | Purpose |
| --- | --- |
| User | Supervisors and verifiers |
| Recipe | Garment recipe and fabric standards |
| RecipeComponent | Pieces that belong to a recipe |
| CuttingOrder | A cutting job against a recipe |
| VerificationItem | Expected vs actual qty per component |
| VerificationLog | Approve/reject decisions |

Enums: `UserRole`, `OrderStatus`, `VerificationItemStatus`, `VerificationDecision`.

Schema file: `backend/prisma/schema.prisma`.
