export type GitHost = 'github' | 'gitlab' | 'bitbucket' | 'other';

export interface RemoteWeb {
    host: GitHost;
    webRoot: string;
}

export function parseRemoteUrl(url: string): RemoteWeb | null {
    const cleaned = url.trim().replace(/\.git$/, '');
    let path = '';

    const ssh = cleaned.match(/^git@([^:]+):(.+)$/);
    const sshUrl = cleaned.match(/^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/);
    const https = cleaned.match(/^https?:\/\/([^/]+)\/(.+)$/);

    let hostname = '';
    if (ssh) {
        hostname = ssh[1];
        path = ssh[2];
    } else if (sshUrl) {
        hostname = sshUrl[1];
        path = sshUrl[2];
    } else if (https) {
        hostname = https[1];
        path = https[2];
    } else {
        return null;
    }

    path = path.replace(/\.git$/, '').replace(/\/$/, '');
    const host: GitHost = hostname.includes('github')
        ? 'github'
        : hostname.includes('bitbucket')
            ? 'bitbucket'
            : hostname.includes('gitlab')
                ? 'gitlab'
                : 'other';

    if (host === 'other' && !hostname) return null;
    return { host, webRoot: `https://${hostname}/${path}` };
}

export function commitWebUrl(remote: RemoteWeb, hash: string): string {
    if (remote.host === 'gitlab') return `${remote.webRoot}/-/commit/${hash}`;
    if (remote.host === 'bitbucket') return `${remote.webRoot}/commits/${hash}`;
    return `${remote.webRoot}/commit/${hash}`;
}

export function issueWebUrl(remote: RemoteWeb, issue: string): string {
    if (remote.host === 'gitlab') return `${remote.webRoot}/-/issues/${issue}`;
    return `${remote.webRoot}/issues/${issue}`;
}

export function linkifyIssues(text: string, remote: RemoteWeb | null): string {
    const safe = escapeHtml(text);
    if (!remote) return safe;
    return safe.replace(/#(\d+)/g, (_match, num: string) => {
        const href = issueWebUrl(remote, num);
        return `<a href="${href}">#${num}</a>`;
    });
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
        if (char === '&') return '&amp;';
        if (char === '<') return '&lt;';
        if (char === '>') return '&gt;';
        if (char === '"') return '&quot;';
        return '&#39;';
    });
}
