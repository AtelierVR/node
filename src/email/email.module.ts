import { Module, forwardRef } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailVerificationService } from './email-verification.service';
import { EmailController } from './email.controller';
import { UsersModule } from '../users/users.module';
import { FediverseModule } from '../fediverse/fediverse.module';

@Module({
    imports: [forwardRef(() => UsersModule), forwardRef(() => FediverseModule)],
    controllers: [EmailController],
    providers: [EmailService, EmailVerificationService],
    exports: [EmailService, EmailVerificationService],
})
export class EmailModule { }
