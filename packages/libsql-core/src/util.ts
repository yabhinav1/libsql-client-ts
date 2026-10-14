import { Base64 } from "js-base64";
import {
    ResultSet,
    Row,
    Value,
    TransactionMode,
    InStatement,
    InArgs,
    ExecuteOptions,
    BatchOptions,
    LibsqlError,
} from "./api";

function checkTimeout(timeout: unknown): number | undefined {
    if (timeout === undefined) {
        return undefined;
    }
    if (typeof timeout !== "number" || !(timeout > 0) || !isFinite(timeout)) {
        throw new RangeError(
            "timeout must be a positive number of milliseconds",
        );
    }
    return timeout;
}

/** Sorts out the two `execute()` call forms: `(sql, args?, options?)` and `(stmt, options?)`. */
export function normalizeExecuteArgs(
    stmtOrSql: InStatement,
    argsOrOptions?: InArgs | ExecuteOptions,
    maybeOptions?: ExecuteOptions,
): { stmt: InStatement; options: ExecuteOptions } {
    const isSql = typeof stmtOrSql === "string";
    const options =
        (isSql ? maybeOptions : (argsOrOptions as ExecuteOptions)) ?? {};
    checkTimeout(options.timeout);
    return {
        stmt: isSql
            ? { sql: stmtOrSql, args: (argsOrOptions as InArgs) || [] }
            : stmtOrSql,
        options,
    };
}

/** `batch()` takes either a transaction mode or a {@link BatchOptions} object. */
export function normalizeBatchOptions(
    modeOrOptions: TransactionMode | BatchOptions | undefined,
    defaultMode: TransactionMode,
): { mode: TransactionMode; timeout?: number } {
    if (modeOrOptions === undefined || typeof modeOrOptions === "string") {
        return { mode: modeOrOptions ?? defaultMode };
    }
    return {
        mode: modeOrOptions.mode ?? defaultMode,
        timeout: checkTimeout(modeOrOptions.timeout),
    };
}

/** Rejects with `QUERY_TIMEOUT` if `promise` has not settled after `timeout` ms, calling `onTimeout`
 * first so the caller can close whatever is still running. No timeout means the promise is returned as is.
 * The timeout has already been checked by `normalizeExecuteArgs` or `normalizeBatchOptions`. */
export function withQueryTimeout<T>(
    promise: Promise<T>,
    timeout: number | undefined,
    onTimeout: () => void,
): Promise<T> {
    if (timeout === undefined) {
        return promise;
    }
    let timer: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            onTimeout();
            reject(
                new LibsqlError(
                    `The query did not finish within ${timeout} ms`,
                    "QUERY_TIMEOUT",
                ),
            );
        }, timeout);
    });
    return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

export const supportedUrlLink =
    "https://github.com/libsql/libsql-client-ts#supported-urls";

export function transactionModeToBegin(mode: TransactionMode): string {
    if (mode === "write") {
        return "BEGIN IMMEDIATE";
    } else if (mode === "read") {
        return "BEGIN TRANSACTION READONLY";
    } else if (mode === "deferred") {
        return "BEGIN DEFERRED";
    } else {
        throw RangeError(
            'Unknown transaction mode, supported values are "write", "read" and "deferred"',
        );
    }
}

export class ResultSetImpl implements ResultSet {
    columns: Array<string>;
    columnTypes: Array<string>;
    rows: Array<Row>;
    rowsAffected: number;
    lastInsertRowid: bigint | undefined;

    constructor(
        columns: Array<string>,
        columnTypes: Array<string>,
        rows: Array<Row>,
        rowsAffected: number,
        lastInsertRowid: bigint | undefined,
    ) {
        this.columns = columns;
        this.columnTypes = columnTypes;
        this.rows = rows;
        this.rowsAffected = rowsAffected;
        this.lastInsertRowid = lastInsertRowid;
    }

    toJSON(): any {
        return {
            columns: this.columns,
            columnTypes: this.columnTypes,
            rows: this.rows.map(rowToJson),
            rowsAffected: this.rowsAffected,
            lastInsertRowid:
                this.lastInsertRowid !== undefined
                    ? "" + this.lastInsertRowid
                    : null,
        };
    }
}

function rowToJson(row: Row): unknown {
    return Array.prototype.map.call(row, valueToJson);
}

function valueToJson(value: Value): unknown {
    if (typeof value === "bigint") {
        return "" + value;
    } else if (value instanceof ArrayBuffer) {
        return Base64.fromUint8Array(new Uint8Array(value));
    } else {
        return value;
    }
}
