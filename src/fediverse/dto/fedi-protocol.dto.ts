import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── WebFinger (RFC 7033) ──────────────────────────────────────────────────────

export class WebFingerLinkDto {
    @ApiProperty({ description: 'Link relation type', example: 'self' })
    rel!: string;

    @ApiPropertyOptional({ description: 'MIME type of the linked resource', example: 'application/activity+json' })
    type?: string;

    @ApiPropertyOptional({ description: 'URL of the linked resource', example: 'https://example.com/users/alice' })
    href?: string;

    @ApiPropertyOptional({ description: 'URL template with {uri} placeholder', example: 'https://example.com/.well-known/webfinger?resource={uri}' })
    template?: string;
}

export class WebFingerDocumentDto {
    @ApiProperty({ description: 'Canonical identifier of the subject (acct: URI or URL)', example: 'acct:alice@example.com' })
    subject!: string;

    @ApiPropertyOptional({ type: [String], description: 'Alternate identifiers for the subject', example: ['https://example.com/users/alice'] })
    aliases?: string[];

    @ApiProperty({ description: 'Links describing the subject', type: () => [WebFingerLinkDto] })
    links!: WebFingerLinkDto[];
}

// ── NodeInfo (https://nodeinfo.diaspora.software) ────────────────────────────

export class NodeInfoLinkDto {
    @ApiProperty({ description: 'Relation type (schema URL)', example: 'http://nodeinfo.diaspora.software/ns/schema/2.1' })
    rel!: string;

    @ApiProperty({ description: 'URL to the NodeInfo document', example: 'https://example.com/nodeinfo/2.1' })
    href!: string;
}

export class NodeInfoLinksDto {
    @ApiProperty({ description: 'NodeInfo document links', type: () => [NodeInfoLinkDto] })
    links!: NodeInfoLinkDto[];
}

export class NodeInfoSoftwareDto {
    @ApiProperty({ description: 'Software name', example: 'nox' })
    name!: string;

    @ApiProperty({ description: 'Software version', example: '1.0.0' })
    version!: string;

    @ApiPropertyOptional({ description: 'Source code repository URL', example: 'https://github.com/example/nox' })
    repository?: string;

    @ApiPropertyOptional({ description: 'Project homepage URL', example: 'https://example.com' })
    homepage?: string;
}

export class NodeInfoUsageUsersDto {
    @ApiProperty({ description: 'Total registered user count', example: 100 })
    total!: number;

    @ApiProperty({ description: 'Users active in the past month', example: 50 })
    activeMonth!: number;

    @ApiProperty({ description: 'Users active in the past half-year', example: 75 })
    activeHalfyear!: number;
}

export class NodeInfoUsageDto {
    @ApiProperty({ description: 'User activity statistics', type: () => NodeInfoUsageUsersDto })
    users!: NodeInfoUsageUsersDto;

    @ApiProperty({ description: 'Total local posts', example: 0 })
    localPosts!: number;

    @ApiPropertyOptional({ description: 'Total local comments', example: 0 })
    localComments?: number;
}

export class NodeInfoDocumentDto {
    @ApiProperty({ description: 'NodeInfo schema version', example: '2.1' })
    version!: string;

    @ApiProperty({ description: 'Server software info', type: () => NodeInfoSoftwareDto })
    software!: NodeInfoSoftwareDto;

    @ApiProperty({ description: 'Supported federation protocols', type: [String], example: [] })
    protocols!: string[];

    @ApiProperty({ description: 'Usage statistics', type: () => NodeInfoUsageDto })
    usage!: NodeInfoUsageDto;

    @ApiProperty({ description: 'Whether open registration is enabled', example: false })
    openRegistrations!: boolean;
}
