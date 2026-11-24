using System;
using System.Collections.Generic;

namespace Cpm
{
    public static class PathHelper
    {
        public static string Normalize(string input)
        {
            var parts = new List<string>();
            foreach (var part in input.Split(Path.DirectorySeparatorChar))
            {
                if (part.Length > 0)
                {
                    parts.Add(part);
                }
            }
            return string.Join(Path.DirectorySeparatorChar.ToString(), parts);
        }
    }
}
