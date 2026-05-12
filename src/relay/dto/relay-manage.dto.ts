import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateRelayDto {
    @ApiPropertyOptional({ description: 'Human-readable label', example: 'EU-West #1' })
    @IsOptional()
    @IsString()
    label?: string;

    @ApiPropertyOptional({ description: 'Runner provider type', example: 'docker', enum: ['docker', 'external'] })
    @IsOptional()
    @IsString()
    provider?: string;

    @ApiPropertyOptional({ description: 'Initial tags', type: [String], example: ['eu', 'fast'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @ApiPropertyOptional({ description: 'Max number of instances the relay may host', example: 3 })
    @IsOptional()
    @IsInt()
    @Min(1)
    max_instances?: number;
}

export class UpdateRelayTagsDto {
    @ApiProperty({ description: 'Complete list of tags to set on the relay', type: [String], example: ['eu', 'fast'] })
    @IsArray()
    @IsString({ each: true })
    tags!: string[];
}

export class AssignInstanceDto {
    @ApiProperty({ description: 'Internal numeric instance ID to assign to this relay', example: 42 })
    @IsInt()
    @Min(1)
    instance_id!: number;
}
