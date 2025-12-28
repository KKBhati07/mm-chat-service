import { Injectable, Logger, Scope } from '@nestjs/common';
import { ContextService } from '../context/context.service';
import { APP_CONSTANTS } from '../../shared/app.constants';

@Injectable({ scope: Scope.DEFAULT })
export class AppLogger extends Logger {
  private loggerContext: string;

  constructor(
    context: string,
    private readonly contextService?: ContextService,
  ) {
    super(context);
    this.loggerContext = context;
  }

  setContext(context: string) {
    this.loggerContext = context;
  }

  private enrich(message: string, optionalParams: any[]): string {
    if (!this.contextService) return message;

    const requestId = this.contextService.get<string>(
      APP_CONSTANTS.REQUEST_CONTEXT.REQUEST_ID,
    );
    const socketId = this.contextService.get<string>(
      APP_CONSTANTS.REQUEST_CONTEXT.SOCKET_ID,
    );
    const userUuid = this.contextService.get<string>(
      APP_CONSTANTS.REQUEST_CONTEXT.USER_UUID,
    );

    const meta = [
      requestId && `reqId=${requestId}`,
      socketId && `socketId=${socketId}`,
      userUuid && `userUuid=${userUuid}`,
    ]
      .filter(Boolean)
      .join(' ');

    const params = this.formatParams(optionalParams);
    return `${meta ? `[${meta}] ` : ''}${message}${params}`;
  }

  log(message: string, ...optionalParams: any[]) {
    super.log(this.enrich(message, optionalParams), this.loggerContext);
  }

  warn(message: string, ...optionalParams: any[]) {
    super.warn(this.enrich(message, optionalParams), this.loggerContext);
  }

  error(message: string, stack?: string, ...optionalParams: any[]) {
    super.error(
      this.enrich(message, optionalParams),
      stack,
      this.loggerContext,
    );
  }

  debug(message: string, ...optionalParams: any[]) {
    super.debug(this.enrich(message, optionalParams), this.loggerContext);
  }

  verbose(message: string, ...optionalParams: any[]) {
    super.verbose(this.enrich(message, optionalParams), this.loggerContext);
  }

  private formatParams(params: any[]): string {
    if (!params.length) return '';
    return (
      ' :: ' +
      params
        .map((p) => (typeof p === 'object' ? JSON.stringify(p) : String(p)))
        .join(' :: ')
    );
  }
}
