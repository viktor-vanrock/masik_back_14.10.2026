import { genSalt, hash } from 'bcrypt';

export const hashValue = async (value: string): Promise<string> => {
  const salt = await genSalt();
  return hash(value, salt);
};
