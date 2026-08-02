export type BoardHomework = {
  id: string;
  content: string;
  tags: string[];
  expired?: boolean;
};

export type SubjectGroup = {
  name: string;
  homeworks: BoardHomework[];
};
