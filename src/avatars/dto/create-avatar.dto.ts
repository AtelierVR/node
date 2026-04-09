import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAvatarDto {
    @ApiProperty({ description: 'Avatar display name', example: 'My Cool Avatar' })
    @IsString()
    @IsNotEmpty()
    title!: string;

    @ApiPropertyOptional({ type: 'string', example: 'A detailed avatar description', nullable: true })
    @IsOptional()
    @IsString()
    description?: string | null;
}

