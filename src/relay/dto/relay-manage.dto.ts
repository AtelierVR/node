import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRelayDto {
    @ApiPropertyOptional({ description: 'Human-readable label', example: 'EU-West #1' })
    @MaxLength(64)
    @IsOptional()
    @IsString()
    label?: string;

    @ApiPropertyOptional({ description: 'Runner provider type', example: 'docker', enum: ['docker', 'external'] })
    @MaxLength(32)
    @Matches(/^[a-z][a-z0-9_-]*$/, { message: 'provider must be a lowercase identifier' })
    @IsOptional()
    @IsString()
    provider?: string;

    @ApiPropertyOptional({ description: 'Initial tags', type: [String], example: ['eu', 'fast'] })
    @ArrayMaxSize(20)
    @MaxLength(32, { each: true })
    @Matches(/^[a-zA-Z0-9:_-]+$/, { each: true, message: 'tags must be alphanumeric (with : _ -)' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @ApiPropertyOptional({ description: 'Max number of instances the relay may host', example: 3 })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(1024)
    @Type(() => Number)
    max_instances?: number;
}

export class UpdateRelayTagsDto {
    @ApiProperty({ description: 'Complete list of tags to set on the relay', type: [String], example: ['eu', 'fast'] })
    @ArrayMaxSize(20)
    @MaxLength(32, { each: true })
    @Matches(/^[a-zA-Z0-9:_-]+$/, { each: true, message: 'tags must be alphanumeric (with : _ -)' })
    @IsArray()
    @IsString({ each: true })
    tags!: string[];
}

export class AssignInstanceDto {
    @ApiProperty({ description: 'Internal numeric instance ID to assign to this relay', example: 42 })
    @IsInt()
    @Min(1)
    @Type(() => Number)
    instance_id!: number;
}
