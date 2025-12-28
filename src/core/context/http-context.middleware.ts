import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ContextService } from './context.service';

@Injectable()
export class HttpContextMiddleware implements NestMiddleware {
  constructor(private readonly contextService: ContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = req.headers['x-request-id'] || randomUUID();

    this.contextService.run(() => {
      this.contextService.set('requestId', requestId);
      this.contextService.set('path', req.path);
      this.contextService.set('method', req.method);

      next();
    });
  }
}
