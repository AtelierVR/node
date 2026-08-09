import { IsBoolean } from 'class-validator';

export type ApiRelationType = 'follow' | 'request';

export interface ApiRelation {
    id: string;
    type: ApiRelationType;
    initiator: string;
    target: string;
    created_at: number;
}

export interface S2SRelationDto {
    initiator: number;
    target: number;
    type: 'follow' | 'unfollow' | 'follow_accept' | 'follow_refuse';
}

/** Expected data shape for S2S /api/relations responses. */
export class S2SRelationResponseDto {
    @IsBoolean()
    success!: boolean;
}
