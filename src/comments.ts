import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type { NormalizedProject, SpecComment } from './types.js';
import { WirestateError } from './errors.js';

export interface CommentInput {
  id?: string;
  target?: string;
  body?: string;
  author?: string;
  status?: 'open' | 'resolved';
}

function makeId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function resolveFile(project: NormalizedProject, file?: string): string {
  if (file) return path.resolve(project.rootDir, file);
  const candidate = project.files.find((item) => item.document.comments?.length)
    ?? project.files.find((item) => item.document.imports?.length)
    ?? project.files.find((item) => item.document.machines || item.document.screens)
    ?? project.files[0];
  if (!candidate) throw new WirestateError('No spec file is available for comments', 'COMMENT_FILE');
  return candidate.path;
}

async function mutateComments(
  project: NormalizedProject,
  file: string | undefined,
  mutate: (comments: SpecComment[]) => SpecComment[]
): Promise<SpecComment[]> {
  const target = resolveFile(project, file);
  const document = parseDocument(await fs.readFile(target, 'utf8'));
  const value = document.toJS() as { comments?: SpecComment[] };
  const comments = mutate([...(value.comments ?? [])]);
  document.set('comments', comments);
  await fs.writeFile(target, document.toString({ lineWidth: 100 }), 'utf8');
  return comments;
}

export async function addComment(project: NormalizedProject, input: CommentInput, file?: string): Promise<SpecComment> {
  if (!input.target || !input.body) throw new WirestateError('target and body are required', 'COMMENT_INVALID');
  const now = new Date().toISOString();
  const comment: SpecComment = {
    id: input.id ?? makeId(),
    target: input.target,
    body: input.body,
    ...(input.author ? { author: input.author } : {}),
    status: input.status ?? 'open',
    createdAt: now,
    updatedAt: now
  };
  await mutateComments(project, file, (comments) => {
    if (comments.some((item) => item.id === comment.id)) throw new WirestateError(`Comment already exists: ${comment.id}`, 'COMMENT_DUPLICATE');
    return [...comments, comment];
  });
  return comment;
}

export async function updateComment(
  project: NormalizedProject,
  id: string,
  input: CommentInput,
  file?: string
): Promise<SpecComment> {
  let updated: SpecComment | undefined;
  await mutateComments(project, file, (comments) => comments.map((comment) => {
    if (comment.id !== id) return comment;
    updated = {
      ...comment,
      ...(input.target ? { target: input.target } : {}),
      ...(input.body ? { body: input.body } : {}),
      ...(input.author ? { author: input.author } : {}),
      ...(input.status ? { status: input.status } : {}),
      updatedAt: new Date().toISOString()
    };
    return updated;
  }));
  if (!updated) throw new WirestateError(`Unknown comment: ${id}`, 'COMMENT_UNKNOWN');
  return updated;
}

export async function removeComment(project: NormalizedProject, id: string, file?: string): Promise<void> {
  let removed = false;
  await mutateComments(project, file, (comments) => comments.filter((comment) => {
    if (comment.id === id) {
      removed = true;
      return false;
    }
    return true;
  }));
  if (!removed) throw new WirestateError(`Unknown comment: ${id}`, 'COMMENT_UNKNOWN');
}
