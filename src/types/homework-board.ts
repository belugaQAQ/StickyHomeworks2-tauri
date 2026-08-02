export type BoardHomework = {
  id: string;
  content: string;
  tags: string[];
  expired?: boolean;
  expiredMarkColor?: string;
};

export type SubjectGroup = {
  name: string;
  homeworks: BoardHomework[];
};
