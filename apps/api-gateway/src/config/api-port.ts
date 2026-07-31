import { DEFAULT_API_PORT } from '../constants/application.constants';

export function resolveApiPort(
  rawValue: string | undefined = process.env.API_PORT,
): number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return DEFAULT_API_PORT;
  }

  const parsedPort = Number(rawValue);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }

  return parsedPort;
}
