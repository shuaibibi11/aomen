/** Minimal SQL boundary that keeps repository tests independent from pg. */
export interface SqlQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount?: number | null;
}

export interface SqlQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface SqlTransactionClient extends SqlQueryExecutor {
  release(): void;
}

export interface SqlConnectionPool extends SqlQueryExecutor {
  connect(): Promise<SqlTransactionClient>;
}
