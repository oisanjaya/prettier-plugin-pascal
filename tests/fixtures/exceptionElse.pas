program ExceptionElseTest;
begin
  try x := 1; except x := 2; else x := 3; end;
end.
