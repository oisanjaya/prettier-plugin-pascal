program ExceptionHandlerTest;
begin
  try
    x := 1;
  except
    on E: Exception do raise E;
  end;
end.

