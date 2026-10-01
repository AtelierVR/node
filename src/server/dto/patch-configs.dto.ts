import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfigPatchItemDto {
    @ApiProperty({ example: 'http.port', description: 'Dot-separated config key path' })
    @MaxLength(128)
    // Only allow dotted camelCase/snake_case segments — rejects path traversal,
    // prototype-pollution payloads (__proto__, constructor, prototype) and odd keys.
    @Matches(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/, {
        message: 'key must be a dot-separated path of valid config segments',
    })
    @IsString()
    @IsNotEmpty()
    key!: string;

    @ApiPropertyOptional({ example: '8080', nullable: true, description: 'New value, or null to reset to default' })
    @MaxLength(4096)
    @IsOptional()
    @IsString()
    value!: string | null;
}
