import { createZodDto } from 'nestjs-zod';
import { ListBranchesQuerySchema, ListRepositoriesQuerySchema } from '@selfship/shared';

/** Query of `GET /github/installations/:id/repositories`. */
export class ListRepositoriesQueryDto extends createZodDto(ListRepositoriesQuerySchema) {}

/** Query of `GET /github/installations/:id/branches`. */
export class ListBranchesQueryDto extends createZodDto(ListBranchesQuerySchema) {}
