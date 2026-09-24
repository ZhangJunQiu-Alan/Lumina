export type AppEnv = {
  Variables: {
    userId: string;
    requestId: string;
    authUser?: {
      id: string;
      email: string;
      full_name: string | null;
    };
  };
};
