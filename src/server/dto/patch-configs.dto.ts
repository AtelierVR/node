import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfigPatchItemDto {
    @ApiProperty({ example: 'http.port', description: 'Dot-separated config key path' })
    @IsString()
    @IsNotEmpty()
    key!: string;

    @ApiPropertyOptional({ example: '8080', nullable: true, description: 'New value, or null to reset to default' })
    @IsOptional()
    @IsString()
    value!: string | null;
}
