import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendCommandDto {
    @ApiProperty({ example: 'relay_stop', description: 'Command string to send to the relay process' })
    @MaxLength(1024)
    @IsString()
    @IsNotEmpty()
    content: string;
}
