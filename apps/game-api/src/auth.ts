import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
export function validToken(value: unknown): boolean {
  const secret = process.env.ADMIN_TOKEN;
  if (typeof value !== 'string' || !secret || secret.length < 32) return false;
  const expected = Buffer.from(secret), supplied = Buffer.from(value);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (!validToken(request.headers.authorization?.replace(/^Bearer /, ''))) throw new UnauthorizedException('Admin token is required.');
    return true;
  }
}
