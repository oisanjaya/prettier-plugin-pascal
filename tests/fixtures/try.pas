program TryTest;
begin
  try
    x := 1;
  finally
    x := 2;
  end;
end.

