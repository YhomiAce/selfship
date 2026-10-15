import { createZodDto } from 'nestjs-zod';
import { CreateProjectSchema, DetectProjectSchema, UpdateProjectSchema } from '@selfship/shared';

/** Body of `POST /projects/detect`. */
export class DetectProjectDto extends createZodDto(DetectProjectSchema) {}

/** Body of `POST /projects`. */
export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}

/** Body of `PATCH /projects/:id`. */
export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}
