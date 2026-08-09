import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Email')
@Controller('email')
export class EmailController {
    // Routes migrated to auth methods: /auth/methods/email/{setup,enable,send}
}
