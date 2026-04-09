export type ApiRelationType = 'follow' | 'request';

export interface ApiRelation {
    id: string;
    type: ApiRelationType;
    target: string;
    created_at: number;
}

export interface S2SRelationDto {
    initiator: number;
    target: number;
    type: 'follow' | 'unfollow' | 'follow_accept' | 'follow_refuse';
}
